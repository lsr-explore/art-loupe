# What face detection sends to Google

Content for a page linked from the About site. The About site is not built yet; this is the
text it will carry, kept here so it changes in the same pull request as the behaviour it
describes ([#43](https://github.com/lsr-explore/art-loupe/issues/43)).

---

Art Loupe finds faces in the photographs you upload using MediaPipe, an open-source library
from Google. It runs on Art Loupe's server, not in your browser, and it runs on **every
photograph you upload** — finding out whether a photograph has a face in it is how Art Loupe
decides whether to offer head-construction guides.

**Each time it looks at a new photograph, MediaPipe sends Google a small usage report.** Art
Loupe did not choose this and cannot switch it off: the library does it on its own, and it
offers no setting to stop it. We would rather tell you than leave it unsaid.

## What the report contains

- Which MediaPipe feature ran — here, face landmark detection.
- When the analysis started and finished, and any errors.
- Basic information about the server it ran on.

**It does not contain your photograph or anything found in it.** We measured each report at
under 1 kB — far too small to carry a photograph or the 478 points face detection finds. The
report is encrypted in transit, so we could not read it directly; what it contains comes from
MediaPipe's own code.

## Where and how often

- The report goes to `play.googleapis.com`, Google's usage-logging service.
- One report per photograph analysed. Art Loupe keeps the result with your study, so opening
  the study again does not run face detection again and sends nothing.

## What you can do

Nothing in Art Loupe's settings changes this, because nothing in MediaPipe does. If you would
rather no report were sent about a photograph, do not upload it.
