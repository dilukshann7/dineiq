"""Drain full ASGI requests and background jobs before a destructive reset."""

import time
from contextlib import contextmanager
from threading import Condition

from fastapi import HTTPException
from starlette.responses import JSONResponse


class LifecycleGate:
    def __init__(self):
        self.condition = Condition()
        self.active = 0
        self.resetting = False

    def enter(self):
        with self.condition:
            if self.resetting:
                raise HTTPException(
                    503, "Reset in progress. Please retry.", headers={"Retry-After": "1"}
                )
            self.active += 1

    def leave(self):
        with self.condition:
            self.active -= 1
            self.condition.notify_all()

    @contextmanager
    def operation(self):
        self.enter()
        try:
            yield
        finally:
            self.leave()

    @contextmanager
    def exclusive(self, timeout=15):
        with self.condition:
            if self.resetting:
                raise HTTPException(409, "Another reset is already in progress.")
            self.resetting = True
            self.condition.notify_all()
            deadline = time.monotonic() + timeout
            try:
                while self.active:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise HTTPException(409, "Operations are still finishing. Retry reset.")
                    self.condition.wait(remaining)
            except BaseException:
                self.resetting = False
                self.condition.notify_all()
                raise
        try:
            yield
        finally:
            with self.condition:
                self.resetting = False
                self.condition.notify_all()

    def background(self, callback):
        try:
            self.enter()
        except HTTPException:
            return
        try:
            callback()
        finally:
            self.leave()


class LifecycleMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        # Reset owns exclusive admission itself, including preflight validation.
        exempt = scope.get("path") == "/health" or (
            scope.get("path") == "/admin/reset" and scope.get("method") == "POST"
        )
        if scope["type"] != "http" or scope.get("method") == "OPTIONS" or exempt:
            return await self.app(scope, receive, send)
        gate = scope["app"].state.lifecycle
        try:
            gate.enter()
        except HTTPException as exc:
            response = JSONResponse(
                {"detail": exc.detail},
                status_code=exc.status_code,
                headers={**exc.headers, "Cache-Control": "no-store"},
            )
            return await response(scope, receive, send)
        try:
            # Count the whole response, not just dependency evaluation or inference.
            await self.app(scope, receive, send)
        finally:
            gate.leave()
