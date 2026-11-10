"""The voice stack: wake word, microphone capture, speech-to-text, text-to-speech, and the hands-free loop.

Every heavy dependency is imported lazily so the rest of Jarvis works without the ``voice`` extra.
"""

from .sentences import SentenceBuffer, guess_language

__all__ = ["SentenceBuffer", "guess_language"]
