"""Monitoring failures translated to HTTP responses at the API boundary."""


class MonitorError(Exception):
    def __init__(self, status: int, detail: str):
        self.status = status
        self.detail = detail
