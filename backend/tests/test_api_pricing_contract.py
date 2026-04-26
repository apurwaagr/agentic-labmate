import unittest

from backend.labmate.api_logic import build_experiment_plan


class ApiPricingContractTests(unittest.TestCase):
    def test_plan_materials_include_pricing_metadata(self):
        hypothesis = (
            "Trehalose at 200 mM improves post-thaw viability of HeLa cells by at least 20% "
            "versus standard 10% DMSO control under identical freezing and thawing conditions."
        )
        payload = build_experiment_plan(hypothesis, [])
        materials = payload["experiment"]["materials"]
        self.assertTrue(materials, "Expected at least one material in generated plan.")
        first = materials[0]
        self.assertIn("unitCostUsd", first)
        self.assertIn("pricingSource", first)
        self.assertIn("pricingConfidence", first)
        self.assertIn("pricingTimestamp", first)

    def test_every_material_has_pricing_provenance(self):
        hypothesis = (
            "A paper-based electrochemical biosensor with anti-CRP antibodies detects C-reactive "
            "protein below 0.5 mg/L within 10 minutes compared to ELISA."
        )
        payload = build_experiment_plan(hypothesis, [])
        materials = payload["experiment"]["materials"]
        self.assertTrue(materials, "Expected generated materials.")
        for material in materials:
            self.assertIn("unitCostUsd", material)
            self.assertIn("pricingSource", material)
            self.assertIn("pricingConfidence", material)
            self.assertIn("pricingTimestamp", material)


if __name__ == "__main__":
    unittest.main()
