import ipaddress

from rest_framework.throttling import SimpleRateThrottle


class ClientThrottle(SimpleRateThrottle):
    """Limits per client address, one counter per scope."""

    def get_ident(self, request):
        """The client address; an IPv6 client is keyed on its /64, which one host controls."""
        ident = super().get_ident(request)
        try:
            address = ipaddress.ip_address(ident)
        except ValueError:
            return ident
        if address.version == 6:
            return str(ipaddress.ip_network(f'{address}/64', strict=False))
        return str(address)

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}


class CaseWriteThrottle(ClientThrottle):
    """Limit case writes per client IP. Reads are never counted."""

    scope = 'case_write'

    def allow_request(self, request, view):
        if request.method not in ('POST', 'PUT', 'PATCH', 'DELETE'):
            return True
        return super().allow_request(request, view)


class ReportDraftThrottle(ClientThrottle):
    scope = 'report_draft'


class CasePreviewThrottle(ClientThrottle):
    """Limit share previews per client IP, apart from the writes, which never count them."""

    scope = 'case_preview'
