import inspect

# Keep Ubuntu's default sitecustomize behaviour (apport hook) when available.
try:
    import apport_python_hook
except ImportError:
    pass
else:
    apport_python_hook.install()

# Python 3.12 removed inspect.getargspec which chumpy still uses.
if not hasattr(inspect, "getargspec"):
    inspect.getargspec = inspect.getfullargspec

# numpy>=1.24 removed legacy aliases (np.bool/np.int/...) that chumpy expects.
try:
    import numpy as _np

    _aliases = {
        "bool": getattr(_np, "bool_", bool),
        "int": getattr(_np, "int_", int),
        "float": getattr(_np, "float64", float),
        "complex": getattr(_np, "complex128", complex),
        "object": getattr(_np, "object_", object),
        "str": getattr(_np, "str_", str),
        "unicode": getattr(_np, "unicode_", str),
    }
    for _name, _value in _aliases.items():
        if _name not in _np.__dict__:
            setattr(_np, _name, _value)
except Exception:
    pass
