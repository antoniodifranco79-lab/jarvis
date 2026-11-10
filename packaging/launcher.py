"""Entry point of the standalone (PyInstaller) build: `JARVIS` opens the app, `JARVIS doctor` etc. still work."""

import multiprocessing
import sys

from jarvis.cli import main

if __name__ == "__main__":
    multiprocessing.freeze_support()
    main(sys.argv[1:] or ["app"])
