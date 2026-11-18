import logging
import traceback

from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import OperationalError, transaction
from django.db.models import F
from django.contrib.auth.decorators import login_not_required
from django.shortcuts import get_object_or_404
from django.utils import timezone, translation
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from api import anonymous_case, case_commands, invites, preview, sharing
from api.snapshots import READ_VERSIONS, SnapshotError, decode, default_name, encode_v2, ensure_writable, write_version
from engine.contracts import ContractError
from presentation.money import PresentationError
from api.models import SavedCase, ShareInvite, ShareLink
from api.permissions import CsrfProtectedWrites
from api.throttling import CasePreviewThrottle, CaseWriteThrottle, ShareInviteThrottle, ShareViewThrottle
from mawareeth.middleware import busy_response, is_lock_timeout
from reports.status import report_status

logger = logging.getLogger(__name__)


@method_decorator(login_not_required, name='dispatch')
class ApiView(APIView):
    """Base for every API view: DRF permissions answer in JSON.

    LoginRequiredMiddleware runs first and would otherwise send anonymous API
    clients a redirect to the HTML login page. This opts out of it only; access
    is still decided by permission_classes, which default to IsAuthenticated.
    """

    def handle_exception(self, exc):
        if isinstance(exc, SnapshotError):
            return Response({'detail': 'This case version is unsupported.', 'code': exc.code}, status=422)
        return super().handle_exception(exc)


@method_decorator([ensure_csrf_cookie, never_cache], name='dispatch')
class SessionView(ApiView):
    """Tell the frontend whether this browser is logged in, and issue its CSRF cookie."""

    permission_classes = [AllowAny]

    def get(self, request):
        return Response({'authenticated': request.user.is_authenticated})


@method_decorator(never_cache, name='dispatch')
class CaseView(ApiView):
    """Read or start the visitor's case, held in the session (no database case rows)."""

    permission_classes = [CsrfProtectedWrites]
    throttle_classes = [CaseWriteThrottle]

    def get(self, request):
        case = anonymous_case.get(request)
        if case is None and anonymous_case.is_expired(request):
            return Response({'case': None, 'code': 'expired'})
        return Response({'case': case})

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        replace = data.get('replace') is True
        try:
            existing = anonymous_case.get(request)
        except SnapshotError as error:
            if not replace:
                raise
            stored = request.session.get(anonymous_case.SESSION_KEY, {})
            stored_id = stored.get('id') if isinstance(stored, dict) else None
            meant = data.get('case_id')
            if isinstance(meant, str) and meant != stored_id:
                return Response(
                    {'detail': 'That case is no longer the current one.', 'code': error.code},
                    status=status.HTTP_409_CONFLICT)
            existing = None
        # A tab confirming "start over" names the case it showed; replacing a newer one is refused.
        meant = data.get('case_id')
        if existing and replace and isinstance(meant, str) and meant != existing['id']:
            return conflict_response(existing)
        # A tab that names the revision it showed must still be looking at that revision.
        if 'expected_revision' in data and not case_commands.valid_revision(data['expected_revision']):
            return Response(
                {'error': 'invalid_revision', 'detail': 'expected_revision must be an integer.'},
                status=status.HTTP_400_BAD_REQUEST)
        if existing and 'expected_revision' in data and data['expected_revision'] != existing['revision']:
            return conflict_response(existing)
        if existing and not replace:
            return Response({'detail': 'A case already exists.', 'case': existing}, status=status.HTTP_409_CONFLICT)
        return Response({'case': anonymous_case.start(request)}, status=status.HTTP_201_CREATED)

    def patch(self, request):
        data = request.data
        if not isinstance(data, dict):
            return Response({'detail': 'Expected a JSON object.'}, status=status.HTTP_400_BAD_REQUEST)
        case_id = data.get('case_id')
        if case_id is not None and not isinstance(case_id, str):
            return Response({'detail': 'case_id must be a string.'}, status=status.HTTP_400_BAD_REQUEST)
        madhab = data.get('madhab')
        if not isinstance(madhab, str) or madhab not in anonymous_case.MADHABS:
            return Response({'detail': 'Unknown madhab.'}, status=status.HTTP_400_BAD_REQUEST)
        return respond_to_command(
            request, 'set_basis', data, case_id,
            lambda: anonymous_case.set_madhab(request, madhab, case_id))


@method_decorator(never_cache, name='dispatch')
class CaseWriteView(ApiView):
    """Base for the interview writes: each needs the case_id and answers with the whole case."""

    permission_classes = [CsrfProtectedWrites]
    throttle_classes = [CaseWriteThrottle]

    def write(self, request, command, action, success=status.HTTP_200_OK, data=None, impact=None):
        """Run `action(data, case_id)` as the command `command` and answer with the whole case.

        `data` replaces the request body for a write that carries its input elsewhere. `impact`
        is `impact(case, data)` for a command that can drop other people.
        """
        data = request.data if data is None else data
        if not isinstance(data, dict):
            return Response({'detail': 'Expected a JSON object.'}, status=status.HTTP_400_BAD_REQUEST)
        case_id = data.get('case_id')
        if not isinstance(case_id, str) or not case_id:
            return Response({'detail': 'case_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        return respond_to_command(
            request, command, data, case_id, lambda: action(data, case_id), success=success,
            impact=None if impact is None else (lambda case: impact(case, data)))


def conflict_response(case):
    return Response(
        {'error': 'conflict', 'detail': 'That case is no longer the current one.', 'case': case},
        status=status.HTTP_409_CONFLICT)


def respond_to_command(request, command, data, case_id, run, success=status.HTTP_200_OK, impact=None):
    """Run one case command through the service and map its outcomes to responses."""
    try:
        case = case_commands.execute(
            request, command, case_id=case_id, expected_revision=data.get('expected_revision'),
            run=run, impact=impact, confirm=data.get('confirm_cascade') is True)
    except anonymous_case.FieldErrors as invalid:
        return Response(
            {'detail': 'Invalid input.', 'errors': invalid.errors,
             **({'questions': invalid.questions} if invalid.questions is not None else {})},
            status=status.HTTP_400_BAD_REQUEST)
    except anonymous_case.StaleCase as stale:
        return conflict_response(stale.case)
    except case_commands.Conflict as conflict:
        return conflict_response(conflict.case)
    except case_commands.InvalidRevision:
        return Response(
            {'error': 'invalid_revision', 'detail': 'expected_revision must be an integer.'},
            status=status.HTTP_400_BAD_REQUEST)
    except case_commands.CascadeUnconfirmed as unconfirmed:
        return Response(
            {'error': 'cascade_unconfirmed', 'detail': 'This change needs confirmation.',
             'impact': unconfirmed.impact, 'case': unconfirmed.case},
            status=status.HTTP_409_CONFLICT)
    except case_commands.OverCapacity:
        return Response(
            {'error': 'over_capacity',
             'detail': f'A layer holds at most {anonymous_case.MAX_HEIRS} heirs.'},
            status=status.HTTP_400_BAD_REQUEST)
    except case_commands.InvalidInput as invalid:
        return Response(
            {'error': 'invalid_input', 'detail': 'Invalid input.', 'errors': invalid.errors},
            status=status.HTTP_400_BAD_REQUEST)
    except case_commands.InvalidSnapshot:
        return Response(
            {'error': 'invalid_snapshot', 'detail': 'That snapshot cannot be restored.'},
            status=status.HTTP_400_BAD_REQUEST)
    except anonymous_case.HeirNotFound as missing:
        return Response(
            {'detail': 'That heir no longer exists.', 'case': missing.case},
            status=status.HTTP_404_NOT_FOUND)
    if case is None:
        return no_case_response(request)
    return Response({'case': case}, status=success)


def no_case_response(request):
    body = {'detail': 'There is no current case.', 'case': None}
    if anonymous_case.is_expired(request):
        body['code'] = 'expired'
    return Response(body, status=status.HTTP_404_NOT_FOUND)


def _query_data(request):
    """The body of a DELETE, which carries its input in the query string."""
    params = request.query_params
    revision = params.get('expected_revision')
    if revision is not None and revision.isascii() and revision.isdigit():
        revision = int(revision)
    return {
        'case_id': params.get('case_id'),
        'expected_revision': revision,
        'confirm_cascade': params.get('confirm_cascade') == 'true',
    }


class DeceasedView(CaseWriteView):
    """Store the deceased on the visitor's case."""

    def put(self, request):
        return self.write(
            request, 'set_deceased', lambda data, case_id: anonymous_case.set_deceased(request, data, case_id))


class HeirsView(CaseWriteView):
    """Add an heir to the visitor's case."""

    def post(self, request):
        return self.write(
            request, 'add_heir', lambda data, case_id: anonymous_case.add_heir(request, data, case_id),
            success=status.HTTP_201_CREATED)


class BulkHeirsView(CaseWriteView):
    """Add many heirs to one layer, all or nothing."""

    def post(self, request):
        return self.write(
            request, 'bulk_add', lambda data, case_id: case_commands.bulk_add(
                request, data.get('heirs'), case_id, data.get('layer')),
            success=status.HTTP_201_CREATED)


class RestoreView(CaseWriteView):
    """Replace the inputs with a snapshot the case exported."""

    def post(self, request):
        return self.write(
            request, 'restore', lambda data, case_id: case_commands.restore(request, data.get('snapshot'), case_id))


class HeirView(CaseWriteView):
    """Edit or remove one heir."""

    def put(self, request, heir_id):
        return self.write(
            request, 'edit_heir', lambda data, case_id: anonymous_case.update_heir(request, heir_id, data, case_id))

    def delete(self, request, heir_id):
        # Intermediaries may drop a DELETE body, so the case id travels in the query string.
        return self.write(
            request, 'remove_heir', lambda data, case_id: anonymous_case.remove_heir(request, heir_id, case_id),
            data=_query_data(request), impact=lambda case, data: case_commands.remove_impact(case, heir_id))


class NotFoundView(ApiView):
    """Answer unknown /api/v1/ paths in JSON instead of Django's HTML 404 page."""

    permission_classes = [AllowAny]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        raise NotFound()


def _asked_language(request):
    """The language the client asks for in Accept-Language, ahead of a language cookie.

    The web app sends its page's locale here, and a cookie left by the legacy pages must not
    override it. Falls back to the language the middleware chose."""
    for code, _quality in translation.trans_real.parse_accept_lang_header(
            request.headers.get('Accept-Language', '')):
        try:
            return translation.get_supported_language_variant(code)
        except LookupError:
            continue
    return translation.get_language()


@method_decorator(never_cache, name='dispatch')
class PreviewView(ApiView):
    """The shares of the visitor's case under its school, from the engine. Writes nothing.

    It reads the session and never touches it, so it does not refresh the expiry.
    """

    permission_classes = [AllowAny]
    throttle_classes = [CasePreviewThrottle]

    def get(self, request):
        case_id = request.query_params.get('case_id')
        if not case_id:
            return Response({'detail': 'case_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        case = anonymous_case.get(request)
        if case is None:
            return no_case_response(request)
        if case['id'] != case_id:
            return Response(
                {'detail': 'That case is no longer the current one.', 'case': case},
                status=status.HTTP_409_CONFLICT)
        try:
            with translation.override(_asked_language(request)):
                body = {**preview.preview(case), 'revision': case['revision']}
        except Exception as error:
            # The kind of error and where it came from, never its message or locals: the case
            # holds names and amounts.
            logger.error(
                'Share preview failed: %s\n%s', type(error).__name__,
                ''.join(traceback.format_tb(error.__traceback__)))
            return Response({'detail': 'The preview is unavailable.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response(body)


class DeathsView(CaseWriteView):
    def post(self, request):
        return self.write(request, 'mark_death', lambda data, case_id: anonymous_case.mark_deceased(
            request, data.get('heir_id'), data.get('first'), case_id,
            relatives=data.get('relatives'), shared_father=data.get('shared_father')), success=status.HTTP_201_CREATED)


class DeathView(CaseWriteView):
    def delete(self, request, heir_id):
        return self.write(request, 'unmark_death', lambda data, case_id: anonymous_case.unmark_deceased(
            request, heir_id, case_id), data=_query_data(request),
            impact=lambda case, data: case_commands.unmark_impact(case, heir_id))


@method_decorator(never_cache, name='dispatch')
class SavedCasesView(ApiView):
    def get(self, request):
        # Only rows this version can open are listed, so one malformed row cannot break the list.
        rows = SavedCase.objects.filter(owner=request.user, schema_version__in=READ_VERSIONS).order_by('-updated_at', '-pk')
        cases = []
        for row in rows:
            try:
                case = decode(row.schema_version, row.snapshot, str(row.pk), row.updated_at.isoformat())
            except SnapshotError:
                continue
            cases.append({'id': row.pk, 'name': row.name, 'updated_at': row.updated_at, 'madhab': case['madhab'],
                          'heir_count': len(case['heirs']), 'status': report_status(case)})
        return Response({'cases': cases})

    def post(self, request):
        data = request.data
        if not isinstance(data, dict) or not isinstance(data.get('case_id'), str) or not data['case_id']:
            return Response({'detail': 'case_id is required.'}, status=400)
        case = anonymous_case.get(request)
        if case is not None and case['id'] != data['case_id']:
            return Response({'detail': 'That case is no longer the current one.'}, status=409)
        if case is None and anonymous_case.is_expired(request):
            return no_case_response(request)
        if case is None or not case['deceased'] or not case['heirs']:
            return Response({'detail': 'Complete the case before saving.'}, status=400)
        version = write_version()
        snapshot = anonymous_case.export_snapshot(case)
        try:
            ensure_writable(snapshot)
            if version == 2:
                snapshot = encode_v2(snapshot)
                decode(2, snapshot, 'snapshot', '')
        except (PresentationError, ContractError, SnapshotError, ValueError, KeyError):
            return Response({'detail': 'The case cannot be saved.', 'code': 'unsupported_content'}, status=400)
        if not case['madhab']:
            # No school is saveable only while all four Sunni schools give the same result.
            try:
                needs_school = preview.preview(case)['status'] == 'choose_school'
            except Exception as error:
                logger.error('Save comparison failed: %s\n%s', type(error).__name__,
                             ''.join(traceback.format_tb(error.__traceback__)))
                return Response({'detail': 'The case cannot be saved right now.'}, status=503)
            if needs_school:
                return Response({'detail': 'Choose a school of law before saving.', 'code': 'school_required'},
                                status=400)
        try:
            # A savepoint: a lock timeout must not leave the request's transaction aborted.
            with transaction.atomic():
                row = (SavedCase.objects.select_for_update()
                       .filter(owner=request.user, pk=anonymous_case.get_saved_link(request, case['id'])).first())
                created = row is None
                if created:
                    row = SavedCase(owner=request.user)
                elif row.revision != anonymous_case.get_saved_base_revision(request, case['id']):
                    return Response({'error': 'conflict', 'code': 'saved_case_conflict',
                                     'detail': 'This saved case changed since it was opened.',
                                     'revision': row.revision}, status=409)
                row.snapshot = snapshot
                row.schema_version = version
                if not created:
                    # Atomic under the row lock, in the same save.
                    row.revision = F('revision') + 1
                row.save()
                if created:
                    row.name = default_name(row.created_at)
                    SavedCase.objects.filter(pk=row.pk).update(name=row.name)
                if not created:
                    row.refresh_from_db(fields=['revision'])
        except OperationalError as error:
            if is_lock_timeout(error):
                return busy_response()
            raise
        anonymous_case.set_saved_link(request, case['id'], row.pk, row.revision)
        return Response({'id': row.pk, 'updated_at': row.updated_at, 'revision': row.revision},
                        status=201 if created else 200)


@method_decorator(never_cache, name='dispatch')
class OpenSavedCaseView(ApiView):
    def post(self, request, id):
        row = get_object_or_404(SavedCase, owner=request.user, pk=id)
        try:
            decoded = decode(row.schema_version, row.snapshot, str(row.pk), row.updated_at.isoformat())
        except SnapshotError as error:
            return Response({'detail': 'This saved case version is unsupported.', 'code': error.code}, status=400)
        try:
            case = anonymous_case.load_snapshot(request, anonymous_case.export_snapshot(decoded))
        except SnapshotError as error:
            return Response({'detail': 'This saved case version is unsupported.', 'code': error.code}, status=400)
        anonymous_case.set_saved_link(request, case['id'], row.pk, row.revision)
        return Response({'case': case})


def _visibility(data, creating):
    """The validated visibility from a share body, or a 400 Response. Public needs the warning accepted."""
    if not isinstance(data, dict):
        return None, Response({'detail': 'Expected a JSON object.'}, status=400)
    visibility = data.get('visibility', ShareLink.PRIVATE if creating else None)
    if visibility not in (ShareLink.PRIVATE, ShareLink.PUBLIC):
        return None, Response({'detail': 'visibility must be private or public.'}, status=400)
    if visibility == ShareLink.PUBLIC and data.get('accept_public_warning') is not True:
        return None, Response({'detail': 'Accept the public link warning first.'}, status=400)
    return visibility, None


def _share_body(share):
    return {'id': share.pk, 'visibility': share.visibility, 'created_at': share.created_at,
            'expires_at': share.expires_at, 'expired': share.expires_at <= timezone.now()}


@method_decorator(never_cache, name='dispatch')
class SavedCaseSharesView(ApiView):
    def get(self, request, id):
        row = get_object_or_404(SavedCase, owner=request.user, pk=id)
        shares = row.shares.filter(revoked_at__isnull=True).order_by('-created_at', '-pk')
        return Response({'shares': [_share_body(share) for share in shares]})

    def post(self, request, id):
        row = get_object_or_404(SavedCase, owner=request.user, pk=id)
        visibility, error = _visibility(request.data, creating=True)
        if error:
            return error
        share, token = sharing.issue(row, visibility, request.user)
        return Response({**_share_body(share), 'token': token}, status=status.HTTP_201_CREATED)


@method_decorator(never_cache, name='dispatch')
class ShareView(ApiView):
    def _share(self, request, id):
        return get_object_or_404(
            ShareLink, pk=id, saved_case__owner=request.user, revoked_at__isnull=True,
            expires_at__gt=timezone.now())

    def patch(self, request, id):
        share = self._share(request, id)
        visibility, error = _visibility(request.data, creating=False)
        if error:
            return error
        if share.visibility != visibility:
            sharing.change_visibility(share, visibility, request.user)
        return Response(_share_body(share))

    def delete(self, request, id):
        share = self._share(request, id)
        sharing.revoke(share, request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class SharedCaseMixin:
    """Resolve a posted token to (share, case). Unknown, revoked and expired tokens share one 404."""

    permission_classes = [CsrfProtectedWrites]

    def unavailable(self):
        return Response({'detail': 'This link is unavailable.'}, status=status.HTTP_404_NOT_FOUND)

    def shared(self, request):
        """Returns (share, case, None) or (None, None, error Response). Never touches the session."""
        data = request.data
        share = sharing.resolve(data.get('token') if isinstance(data, dict) else None)
        if share is None:
            return None, None, self.unavailable()
        row = share.saved_case
        if share.visibility == ShareLink.PRIVATE and not request.user.is_authenticated:
            return None, None, Response(
                {'detail': 'Sign in to view this link.', 'code': 'sign_in_required'}, status=status.HTTP_403_FORBIDDEN)
        try:
            case = decode(row.schema_version, row.snapshot, f'share-{share.pk}', row.updated_at.isoformat())
        except SnapshotError as error:
            return None, None, Response({'detail': 'This link is unavailable.', 'code': error.code}, status=404)
        return share, case, None


@method_decorator(never_cache, name='dispatch')
class SharedViewView(SharedCaseMixin, ApiView):
    throttle_classes = [ShareViewThrottle]

    def post(self, request):
        share, case, error = self.shared(request)
        if error:
            return error
        try:
            with translation.override(_asked_language(request)):
                body = preview.preview(case)
        except Exception as failure:
            logger.error(
                'Shared preview failed: %s\n%s', type(failure).__name__,
                ''.join(traceback.format_tb(failure.__traceback__)))
            return Response({'detail': 'The preview is unavailable.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        sharing.audit(share, request.user, 'viewed')
        return Response({'status': report_status(case), 'visibility': share.visibility,
                         'case': case, 'preview': body})



def _invite_body(invite):
    state = 'expired' if invite.expires_at <= timezone.now() else ('accepted' if invite.accepted_at else 'pending')
    return {'id': invite.pk, 'email': invite.email, 'status': state,
            'accepted_by': invite.accepted_by.get_username() if invite.accepted_by else None,
            'created_at': invite.created_at, 'expires_at': invite.expires_at}


@method_decorator(never_cache, name='dispatch')
class SavedCaseInvitesView(ApiView):
    def get_throttles(self):
        return [ShareInviteThrottle()] if self.request.method == 'POST' else []

    def get(self, request, id):
        row = get_object_or_404(SavedCase, owner=request.user, pk=id)
        rows = row.invites.filter(revoked_at__isnull=True).select_related('accepted_by').order_by('-created_at', '-pk')
        return Response({'invites': [_invite_body(invite) for invite in rows]})

    def post(self, request, id):
        row = get_object_or_404(SavedCase, owner=request.user, pk=id)
        email = request.data.get('email') if isinstance(request.data, dict) else None
        try:
            if not isinstance(email, str) or len(email.strip()) > 254:
                raise ValidationError('Invalid email')
            validate_email(email.strip())
        except ValidationError:
            return Response({'detail': 'A valid email address is required.'}, status=400)
        try:
            invite = invites.issue(row, email, request.user, request, _asked_language(request))
        except invites.DeliveryError:
            return Response({'detail': 'The invitation could not be sent.'}, status=503)
        return Response({'id': invite.pk, 'email': invite.email, 'status': 'pending',
                         'expires_at': invite.expires_at}, status=201)


@method_decorator(never_cache, name='dispatch')
class InviteView(ApiView):
    def delete(self, request, id):
        invite = get_object_or_404(ShareInvite, pk=id, saved_case__owner=request.user, revoked_at__isnull=True)
        invites.revoke(invite, request.user)
        return Response(status=204)


@method_decorator(never_cache, name='dispatch')
class AcceptInviteView(SharedCaseMixin, ApiView):
    throttle_classes = [ShareViewThrottle]

    def post(self, request):
        token = request.data.get('token') if isinstance(request.data, dict) else None
        invite = invites.resolve(token)
        if invite is None:
            return self.unavailable()
        if not request.user.is_authenticated:
            return Response({'code': 'sign_in_required'}, status=403)
        invite = invites.accept(token, request.user)
        return Response({'id': invite.pk}) if invite else self.unavailable()


@method_decorator(never_cache, name='dispatch')
class ReceivedListView(ApiView):
    def get(self, request):
        rows = invites.live().filter(accepted_by=request.user).select_related('saved_case__owner').order_by('-created_at', '-pk')
        return Response({'received': [{'id': row.pk, 'owner': row.saved_case.owner.get_username(),
                         'updated_at': row.saved_case.updated_at, 'expires_at': row.expires_at} for row in rows]})


class ReceivedCaseMixin:
    permission_classes = [CsrfProtectedWrites]

    def received(self, request, id):
        if not request.user.is_authenticated:
            return None, None, Response({'code': 'sign_in_required'}, status=403)
        invite = invites.live().select_related('saved_case__owner').filter(pk=id, accepted_by=request.user).first()
        if invite is None:
            return None, None, Response({'detail': 'This link is unavailable.'}, status=404)
        row = invite.saved_case
        try:
            case = decode(row.schema_version, row.snapshot, f'invite-{id}', row.updated_at.isoformat())
        except SnapshotError as error:
            return None, None, Response({'detail': 'This link is unavailable.', 'code': error.code}, status=404)
        return invite, case, None


@method_decorator(never_cache, name='dispatch')
class ReceivedViewView(ReceivedCaseMixin, ApiView):
    throttle_classes = [ShareViewThrottle]

    def post(self, request, id):
        invite, case, error = self.received(request, id)
        if error:
            return error
        try:
            with translation.override(_asked_language(request)):
                body = preview.preview(case)
        except Exception as failure:
            logger.error('Received preview failed: %s\n%s', type(failure).__name__,
                         ''.join(traceback.format_tb(failure.__traceback__)))
            return Response({'detail': 'The preview is unavailable.'}, status=503)
        sharing.audit(invite, request.user, 'viewed', subject='invite')
        return Response({'status': report_status(case), 'owner': invite.saved_case.owner.get_username(),
                         'case': case, 'preview': body})
