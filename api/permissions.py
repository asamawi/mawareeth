from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import SAFE_METHODS, BasePermission


class CsrfProtectedWrites(BasePermission):
    """Open to everyone, but every unsafe request must carry a valid CSRF token.

    DRF checks CSRF only for logged-in users. Permissions run before throttles, so a
    request rejected here never uses up the client's quota. The failure is DRF's own
    PermissionDenied, answered in JSON.
    """

    def has_permission(self, request, view):
        if request.method not in SAFE_METHODS:
            SessionAuthentication().enforce_csrf(request)
        return True
