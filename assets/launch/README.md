Existing Nota launch-film artwork, packed from D:/notas-launch-work/film/public/logo. Includes all 41 registered spirit drawings, the original bridge frames and the letter reveal at the film’s 24 fps. No generated artwork.

Rebuild and embed in notas.html with Python and Pillow:

    python scripts/build-launch.py --source D:/notas-launch-work/film

The atlas is lossless WebP, embedded immediately after the launch markup so launch never waits for another request. The launch runtime shows each frame once, holds the completed logo, and respects reduced motion and the saved animation preference.
