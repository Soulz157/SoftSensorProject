from .aveva_connect import PIWebAPI

# `object_store` is deliberately NOT re-exported here. This module executes on
# any `intergrations.*` import, so listing it would make the five existing
# `from intergrations import PIWebAPI` call sites eagerly import minio and
# pyarrow — coupling the PI endpoints to storage dependencies they do not use.
# Import it directly instead: `from intergrations.object_store import ...`,
# which is what every other consumer in this service already does.
__all__ = ["PIWebAPI"]
