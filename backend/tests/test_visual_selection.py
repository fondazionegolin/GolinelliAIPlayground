import base64
import io

import pytest
from PIL import Image

from app.services.visual_comprehension import Box, Grounding
from app.services.visual_selection import MARK, Selection, marked_views, with_selection_region


def source():
    out = io.BytesIO(); Image.new("RGB", (800, 400), "white").save(out, format="PNG")
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode()


def decode(url):
    return Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1]))).convert("RGB")


@pytest.mark.parametrize("shape,points", [("rect", []), ("lasso", [(10, 10), (30, 10), (30, 30), (10, 30)]),
                                          ("scribble", [(10, 10), (30, 30)]), ("brush", [(10, 20), (30, 20)])])
def test_every_marking_is_drawn_and_the_area_is_enlarged(shape, points):
    sel = Selection(shape=shape, box=Box(x=10, y=10, width=20, height=20), points=points, brush=3)
    marked, crop = marked_views(source(), sel)
    marked = decode(marked)
    assert any(abs(p[0] - MARK[0]) < 40 and abs(p[2] - MARK[2]) < 40 and p[1] < 200 for p in marked.getdata())
    assert max(decode(crop).size) >= 768


def test_freehand_needs_a_path_inside_the_image():
    with pytest.raises(ValueError):
        Selection(shape="lasso", box=Box(x=0, y=0, width=10, height=10), points=[(5, 5)])
    with pytest.raises(ValueError):
        Selection(shape="scribble", box=Box(x=0, y=0, width=10, height=10), points=[(5, 5), (120, 5)])


def test_only_recent_markings_are_kept_as_regions():
    g = Grounding(subject="x", overview="x", regions=[])
    for i in range(1, 10):
        g = with_selection_region(g, Selection(shape="rect", box=Box(x=i, y=i, width=5, height=5)), f"selezione-{i}")
    assert [r.id for r in g.regions] == [f"selezione-{i}" for i in range(4, 10)]
