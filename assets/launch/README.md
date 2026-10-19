Existing Nota launch-film artwork, packed from D:/notas-launch-work/film/public/logo. Includes all 41 registered spirit drawings, the original bridge frames and the letter reveal at the film’s 24 fps. No generated artwork.

Rebuild and embed in notas.html with Python and Pillow:

    python scripts/build-launch.py --source D:/notas-launch-work/film

The atlas is lossless WebP, embedded immediately after the launch markup so launch never waits for another request. The launch runtime shows every frame once at its natural pace. The loading indicator appears only after one second, and quick starts never reveal it. The notebook opens only once its libraries, stylesheets, fonts and images have arrived (the model readers keep downloading behind the page); a ten second cap keeps a stalled request from holding it, and skip on the loading card opens the notebook without that wait. When the notebook is ready while the drawing is still running, the drawing finishes on the loader at four frames a tick, and only the completed mark moves into the header over 300 ms: the header never receives a half-drawn mark. Quick starts fade the notebook in over 360 ms with a static header logo and no loading animation. Reduced motion and the saved animations-off preference skip motion.
