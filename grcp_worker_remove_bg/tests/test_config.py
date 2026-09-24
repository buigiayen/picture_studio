from server.config import Config


def test_config_defaults():
    cfg = Config(env={})
    assert cfg.port == 50051
    assert cfg.local_enabled is True
    assert cfg.ai_order == ["remove.bg", "clipdrop"]
    assert cfg.beauty_strength == 35


def test_config_parses_env():
    cfg = Config(env={
        "PORTRAIT_PORT": "6000",
        "LOCAL_SEGMENTATION_ENABLED": "false",
        "AI_PROVIDERS_ORDER": " clipdrop , remove.bg ",
        "AI_TIMEOUT_SECONDS": "10",
        "BEAUTY_STRENGTH": "50",
    })
    assert cfg.port == 6000
    assert cfg.local_enabled is False
    assert cfg.ai_order == ["clipdrop", "remove.bg"]
    assert cfg.ai_timeout == 10.0
    assert cfg.beauty_strength == 50
