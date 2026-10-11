import unittest
from types import SimpleNamespace
from unittest.mock import patch

import worker


class PublicTargetValidationTests(unittest.TestCase):
    def test_global_ip_is_accepted(self):
        self.assertEqual(worker.validate_public_target("1.1.1.1"), "1.1.1.1")

    def test_private_ip_is_rejected(self):
        with self.assertRaises(ValueError):
            worker.validate_public_target("192.168.1.1")

    def test_loopback_is_rejected(self):
        with self.assertRaises(ValueError):
            worker.validate_public_target("127.0.0.1")

    def test_url_syntax_is_rejected(self):
        with self.assertRaises(ValueError):
            worker.validate_public_target("http://1.1.1.1/path")


class IcmpResultTests(unittest.TestCase):
    @patch("worker.icmp_ping")
    def test_success_maps_latency_and_packet_loss(self, mocked_ping):
        mocked_ping.return_value = SimpleNamespace(
            is_alive=True, packets_received=3, packet_loss=0, avg_rtt=12.345
        )
        result = worker.ping("1.1.1.1", attempts=3, timeout=2)
        self.assertEqual(result, {
            "success": True, "latency_ms": 12.35, "packet_loss": 0, "error": None
        })
        self.assertFalse(mocked_ping.call_args.kwargs["privileged"])

    @patch("worker.icmp_ping")
    def test_no_reply_is_down_with_full_loss(self, mocked_ping):
        mocked_ping.return_value = SimpleNamespace(
            is_alive=False, packets_received=0, packet_loss=100, avg_rtt=0
        )
        result = worker.ping("1.1.1.1", attempts=3, timeout=2)
        self.assertFalse(result["success"])
        self.assertIsNone(result["latency_ms"])
        self.assertEqual(result["packet_loss"], 100)


if __name__ == "__main__":
    unittest.main()
