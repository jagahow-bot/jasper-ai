from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_validate_pool_csv():
    csv_text = "ticker,name,asset_class,region,product_type,enabled\nAAPL,Apple Inc.,equity,us,stock,true\n"
    res = client.post("/settings/validate-pool", json={"csv_text": csv_text})
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] is True
    assert data["upserted"] == 1
    assert data["errors"] == []
    assert data["items"][0]["ticker"] == "AAPL"


def test_validate_pool_csv_missing_columns():
    csv_text = "name,region\nApple Inc.,us\n"
    res = client.post("/settings/validate-pool", json={"csv_text": csv_text})
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] is False
    assert "ticker" in data["errors"][0]


def test_validate_models_csv():
    csv_text = "id,name,benchmark,ticker,weight\nmodel-1,Model One,SPY,AAPL,0.5\nmodel-1,Model One,SPY,MSFT,0.5\n"
    res = client.post("/settings/validate-models", json={"csv_text": csv_text})
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] is True
    assert data["imported"] == 1
    assert data["errors"] == []
    assert data["portfolios"][0]["id"] == "model-1"


def test_validate_models_csv_bad_weights():
    csv_text = "id,name,benchmark,ticker,weight\nmodel-1,Model One,SPY,AAPL,0.3\nmodel-1,Model One,SPY,MSFT,0.5\n"
    res = client.post("/settings/validate-models", json={"csv_text": csv_text})
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] is False
    assert data["errors"]
