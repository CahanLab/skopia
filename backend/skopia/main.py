"""Skopia FastAPI application entry point."""

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from skopia.adaptor import DataAdaptor
from skopia.api.routes import router, set_adaptor
from skopia import __version__, provenance
from skopia import config as user_config

app = FastAPI(
    title="Skopia",
    description="Modern web app for scRNA-seq and spatial transcriptomics exploration",
    version=__version__,
)

# Configure CORS for development (frontend runs on different port)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite dev server
        "http://127.0.0.1:5173",
        "http://localhost:3000",  # Alternative port
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(router)


@app.on_event("startup")
async def startup_event():
    """Load data on application startup."""
    # Load user config (~/.skopia/config.yaml|.yml|.json or $SKOPIA_CONFIG_PATH).
    # Missing / malformed is logged but not fatal — defaults fall through.
    user_config.load_user_config()

    # Get data file path from environment variable
    data_path = os.environ.get("SKOPIA_DATA_PATH")

    if not data_path:
        # Fall back to bundled toy dataset
        bundled = Path(__file__).parent / "data" / "toy_spatial.h5ad"
        if bundled.exists():
            data_path = str(bundled)
            print("No SKOPIA_DATA_PATH set — using bundled toy_spatial.h5ad")
        else:
            print("Warning: SKOPIA_DATA_PATH not set. Set it to load an h5ad or h5 file.")
            print("Example: SKOPIA_DATA_PATH=/path/to/data.h5ad uvicorn skopia.main:app --reload")
            return

    path = Path(data_path)
    if path.exists():
        print(f"Loading data from: {path}")
        adaptor = DataAdaptor(path)
        set_adaptor(adaptor, slot="primary")
        print(f"Loaded {adaptor.n_cells} cells, {adaptor.n_genes} genes")
    else:
        print(f"Warning: Data file not found: {path}")


@app.get("/")
def root():
    """Root endpoint with basic info."""
    return {
        "name": "Skopia",
        "version": __version__,
        "build": provenance.build_label(),
        "docs": "/docs",
        "api": "/api/schema",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
