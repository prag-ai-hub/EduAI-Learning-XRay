"""Append-only log of admin actions - approvals, suspensions, role changes -
recording actor, action and timestamp but never a sensitive payload.

Routes land here on Day 8.
"""

app_name = "audit"

urlpatterns: list = []
