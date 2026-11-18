"""The one typed error every contract parser raises."""


class ContractError(Exception):
    """A document broke a contract. `code` is a stable code from codes.ERROR_CODES."""

    def __init__(self, code, detail):
        self.code = code
        self.detail = str(detail)
        super().__init__(f'{code}: {self.detail}')

    def to_dict(self):
        return {'error': self.code, 'detail': self.detail}
