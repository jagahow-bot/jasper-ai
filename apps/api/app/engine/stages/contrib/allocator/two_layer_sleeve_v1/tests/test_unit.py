"""(7a) Unit tests for two_layer_sleeve_v1."""

from __future__ import annotations


def test_scaffold_imports() -> None:
    from app.engine.stages.contrib.allocator.two_layer_sleeve_v1.implementation import build_two_layer_sleeve_v1

    stage = build_two_layer_sleeve_v1()
    assert stage.implementation_id == "two_layer_sleeve_v1"
