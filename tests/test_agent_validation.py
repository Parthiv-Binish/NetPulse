import unittest
import agent

class PrivateTargetValidationTests(unittest.TestCase):
    def test_private_ip_allowed(self):
        self.assertEqual(agent.validate_private_target('10.10.2.15'), '10.10.2.15')

    def test_public_ip_rejected(self):
        with self.assertRaises(ValueError):
            agent.validate_private_target('1.1.1.1')

    def test_loopback_rejected(self):
        with self.assertRaises(ValueError):
            agent.validate_private_target('127.0.0.1')

    def test_url_syntax_rejected(self):
        with self.assertRaises(ValueError):
            agent.validate_private_target('http://10.0.0.1/path')

if __name__ == '__main__':
    unittest.main()
