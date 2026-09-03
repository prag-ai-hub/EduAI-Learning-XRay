"""The server-side AI proxy: the provider keys live in this service alone."""

from django.urls import path

from .views import AiHealthView, CompletionView, OcrView

app_name = "aiproxy"

urlpatterns = [
    path("completions", CompletionView.as_view(), name="completions"),
    path("ocr", OcrView.as_view(), name="ocr"),
    path("health", AiHealthView.as_view(), name="health"),
]
