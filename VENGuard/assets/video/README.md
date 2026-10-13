Put short, silent product clips here (5–10 seconds, MP4/H.264, under ~1.5 MB each,
no sound track). Then add them to `gallery.items` in `src/site.json` and rebuild.

Example ffmpeg command to make a light clip from a phone video:

    ffmpeg -i input.mov -an -vf "scale=900:-2,fps=24" -c:v libx264 -crf 30 -preset slow -movflags +faststart valve-closing.mp4

Rules from the brief: real kitchens and hands, calm moments, no fire or fear imagery,
written consent from anyone shown.
