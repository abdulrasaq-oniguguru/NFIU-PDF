from django.contrib import admin


class SingleDateFilter(admin.FieldListFilter):
    """A single native date-picker filter: pick one date, see that day's records.

    Unlike Django's built-in date filter (fixed presets: Today/Past 7 days/...)
    or a from/to range widget, this is one input that filters the field to
    exactly the chosen calendar day (field__date=value).
    """

    template = "admin/pdf_tool/single_date_filter.html"

    def __init__(self, field, request, params, model, model_admin, field_path):
        self.lookup_kwarg = f"{field_path}__date"
        # params is a QueryDict here; .pop() returns a list of values, not a
        # single string, so unwrap it before storing.
        raw_val = params.pop(self.lookup_kwarg, None)
        self.lookup_val = raw_val[-1] if isinstance(raw_val, list) else raw_val
        super().__init__(field, request, params, model, model_admin, field_path)
        other_params = request.GET.copy()
        other_params.pop(self.lookup_kwarg, None)
        self.other_params = other_params.items()

    def expected_parameters(self):
        return [self.lookup_kwarg]

    def choices(self, changelist):
        return []

    def has_output(self):
        return True

    def queryset(self, request, queryset):
        if self.lookup_val:
            queryset = queryset.filter(**{self.lookup_kwarg: self.lookup_val})
        return queryset
