"""Gunicorn configuration.

Sized for a service whose slowest work is waiting on someone else's API - the
AI proxy can block for a minute on a generation call - rather than on CPU.
"""

import multiprocessing
import os

bind = f"0.0.0.0:{os.environ.get('PORT', '8000')}"

# Sync workers, deliberately. gthread or gevent would let one worker hold more
# concurrent AI calls, but the proxy already caps those with a throttle and
# sync workers make a stuck request obvious rather than absorbed.
workers = int(os.environ.get("WEB_CONCURRENCY", multiprocessing.cpu_count() * 2 + 1))
worker_class = "sync"

# Longer than the AI proxy's own 120s read budget, so a slow generation is
# ended by the proxy's timeout - with a usable error - rather than by gunicorn
# killing the worker underneath it.
timeout = 150
graceful_timeout = 30
# Slightly above a typical 60s load-balancer idle timeout, so the balancer
# closes connections rather than handing them to a worker that just did.
keepalive = 65

# Recycling bounds any slow leak in a long-lived worker. The jitter stops every
# worker restarting in the same second.
max_requests = 1000
max_requests_jitter = 100

accesslog = "-"
errorlog = "-"
loglevel = os.environ.get("DJANGO_LOG_LEVEL", "info").lower()
# Log the real client and the time taken; the proxy sits behind a balancer, so
# %(h)s alone is the balancer.
access_log_format = "%({x-forwarded-for}i)s %(m)s %(U)s %(s)s %(L)ss"
