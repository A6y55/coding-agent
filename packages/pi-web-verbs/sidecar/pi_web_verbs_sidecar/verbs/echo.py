from dataclasses import dataclass


@dataclass(frozen=True)
class EchoRequest:
    message: str


@dataclass(frozen=True)
class EchoResponse:
    message: str


def execute(request: dict[str, object]) -> EchoResponse:
    message = request.get("message")
    if not isinstance(message, str):
        raise ValueError("message must be a string")
    return EchoResponse(message=message)
