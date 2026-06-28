import unittest

from fastapi.testclient import TestClient

from app.api.fastapi_app import app


class FastApiAppTests(unittest.TestCase):
    def test_home_renders(self):
        client = TestClient(app)
        response = client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("AI Agent Dashboard", response.text)


if __name__ == "__main__":
    unittest.main()
