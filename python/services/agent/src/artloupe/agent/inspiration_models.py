"""Validated transport contract. Missing provider metadata remains null."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class SearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    source: Literal["pexels", "met"]
    query: str = Field(default="", max_length=150)
    artist: str = Field(default="", max_length=100)
    orientation: Literal["", "landscape", "portrait", "square"] = ""
    size: Literal["", "small", "medium", "large"] = ""
    color: Literal[
        "",
        "red",
        "orange",
        "yellow",
        "green",
        "turquoise",
        "blue",
        "violet",
        "pink",
        "brown",
        "black",
        "gray",
        "white",
    ] = ""
    date_begin: int | None = Field(default=None, ge=-5000, le=2100)
    date_end: int | None = Field(default=None, ge=-5000, le=2100)
    highlights: bool = False
    page: int = Field(default=1, ge=1, le=417)

    @model_validator(mode="after")
    def coherent(self):
        if not self.query and not (self.source == "met" and self.artist):
            raise ValueError("Enter keywords or a Met artist.")
        if self.source == "pexels" and (
            self.artist
            or self.highlights
            or self.date_begin is not None
            or self.date_end is not None
        ):
            raise ValueError("Met filters cannot be used with Pexels.")
        if self.source == "met" and (self.orientation or self.size or self.color):
            raise ValueError("Pexels filters cannot be used with the Met.")
        if (self.date_begin is None) != (self.date_end is None):
            raise ValueError("Enter both dates.")
        if self.date_begin is not None and self.date_begin > self.date_end:
            raise ValueError("Dates must be ordered.")
        return self


class InspirationImage(BaseModel):
    id: str
    source: Literal["pexels", "met"]
    image_url: str
    source_url: str
    title: str
    creator: str | None = None
    medium: str | None = None
    date: str | None = None
    year: int | None = None
    alt: str


class SearchResponse(BaseModel):
    items: list[InspirationImage]
    page: int
    has_more: bool
    stale: bool = False
    partial: bool = False
