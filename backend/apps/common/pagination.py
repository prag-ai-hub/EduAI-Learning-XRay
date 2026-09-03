from rest_framework.pagination import PageNumberPagination


class DefaultPagination(PageNumberPagination):
    """Bounded pagination for every list endpoint.

    A client may ask for a larger page but never an unbounded one - an
    unpaginated cross-school directory is both a performance and a data
    exposure problem.
    """

    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100
