from pydantic import BaseModel


class RootResponse(BaseModel):
    message: str

    model_config = {
        "json_schema_extra": {
            "examples": [
                {"message": "FastAPI is running inside Turborepo 🚀"}
            ]
        }
    }
