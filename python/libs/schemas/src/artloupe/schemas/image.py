"""The reference photograph, as a reference rather than as bytes.

FR-101 sets the accepted formats and bounds; FR-105 makes the original immutable and makes
the checksum the thing derivatives point back to. Nothing downstream ever holds the pixels —
every study, every plate, and every cache entry is keyed on `checksum`, which is the only
identifier that survives a rotating signed URL.

HEIC is accepted by FR-101 but excluded here for slice 1: Pillow needs `pillow-heif` to
decode it and no browser will render it, so admitting it to the contract before the decode
path exists would let an unusable upload through validation.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from artloupe.schemas.evidence import Checksum

# FR-101 accepted formats, minus HEIC. Widening this needs a decode path to match.
AcceptedMimeType = Literal["image/jpeg", "image/png", "image/webp"]

ACCEPTED_MIME_TYPES: tuple[str, ...] = ("image/jpeg", "image/png", "image/webp")

# FR-101: 25 MB.
MAX_UPLOAD_BYTES = 25 * 1024 * 1024

# FR-101: the long edge must reach this, or the studies have nothing to measure.
MIN_LONG_EDGE_PX = 800


class ImageRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    checksum: Checksum
    # Object key within the private bucket. Never a URL — signed URLs expire.
    storage_key: str = Field(min_length=1)
    mime_type: AcceptedMimeType
    width_px: int = Field(gt=0)
    height_px: int = Field(gt=0)
    byte_size: int = Field(gt=0, le=MAX_UPLOAD_BYTES)

    @model_validator(mode="after")
    def _long_edge_is_large_enough(self) -> "ImageRef":
        if max(self.width_px, self.height_px) < MIN_LONG_EDGE_PX:
            raise ValueError(f"the long edge must be at least {MIN_LONG_EDGE_PX}px (FR-101)")
        return self
