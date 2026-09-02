# Checks

- Every model should have a `def structlog_log_context()` 
- All methods should add context to structlog for objects they fetch or touch. 

```
class SomeService:
  def some_method():
    res = Reservation.objects.first()
    structlog.contextvars.bind_contextvars(**res.structlog_log_context()
```

- Structlog should be used well and consistently. 
- Logs should make it easy to follow code paths. 