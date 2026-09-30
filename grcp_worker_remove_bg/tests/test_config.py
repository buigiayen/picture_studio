from server.config import Config


def test_config_defaults():
    cfg = Config(env={})
    assert cfg.port == 50051
    assert cfg.local_enabled is True
    assert cfg.onnx_enabled is True
    assert cfg.onnx_model_dtype == "fp32"
    assert cfg.onnx_execution_providers == ["CPUExecutionProvider"]
    assert cfg.ai_order == []
    assert cfg.alpha_feather == 0
    assert cfg.beauty_strength == 35


def test_config_parses_env():
    cfg = Config(env={
        "PORTRAIT_PORT": "6000",
        "LOCAL_SEGMENTATION_ENABLED": "false",
        "ONNX_SEGMENTATION_ENABLED": "false",
        "ONNX_MODEL_DTYPE": "fp16",
        "ONNX_EXECUTION_PROVIDERS": "CUDAExecutionProvider,CPUExecutionProvider",
        "AI_PROVIDERS_ORDER": " clipdrop , remove.bg ",
        "AI_TIMEOUT_SECONDS": "10",
        "BEAUTY_STRENGTH": "50",
    })
    assert cfg.port == 6000
    assert cfg.local_enabled is False
    assert cfg.onnx_enabled is False
    assert cfg.onnx_model_dtype == "fp16"
    assert cfg.onnx_execution_providers == ["CUDAExecutionProvider", "CPUExecutionProvider"]
    assert cfg.ai_order == ["clipdrop", "remove.bg"]
    assert cfg.ai_timeout == 10.0
    assert cfg.beauty_strength == 50
