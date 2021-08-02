from hypertag import HyperHTML


# standard global Hypertag runtime
hyperhtml = HyperHTML()


def hypertag(view, render = True, **context):
    """
    Utility function that uses Hypertag's HyperHTML runtime with standard loaders
    to translate and (optionally) render a given `view`.
    """
    run = hyperhtml.render if render else hyperhtml.translate
    return run(view, **context)
