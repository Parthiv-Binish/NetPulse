import unittest
import ipaddress
from unittest.mock import patch

import worker

class TargetValidationTests(unittest.TestCase):
    def test_public_ip_allowed(self):
        self.assertEqual(worker.validate_public_target("1.1.1.1"), "1.1.1.1")

    def test_private_ip_rejected_for_public_worker(self):
        with self.assertRaises(ValueError):
            worker.validate_public_target("192.168.1.2")

    def test_loopback_rejected(self):
        with self.assertRaises(ValueError):
            worker.validate_public_target("127.0.0.1")

    def test_invalid_hostname_rejected(self):
        with self.assertRaises(ValueError):
            worker.validate_public_target("http://example.com/path")

    @patch("worker.socket.getaddrinfo")
    def test_hostname_resolving_to_private_ip_rejected(self, mock_dns):
        mock_dns.return_value = [(None, None, None, None, ("10.0.0.2", 0))]
        with self.assertRaises(ValueError):
            worker.validate_public_target("host.example")

if __name__ == "__main__":
    unittest.main()
