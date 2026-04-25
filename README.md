# Scientific Input Parser

A Python module that extracts structured data from natural-language scientific hypotheses using Google's Gemini 2.5 Flash API.

## Features

- **Structured Extraction**: Converts messy scientific questions into typed JSON objects
- **Quality Validation**: Enforces that inputs include quantitative thresholds, specific interventions, and control conditions
- **Clarifying Questions**: Generates targeted questions when information is missing
- **Gemini Integration**: Uses Google's free-tier Gemini 2.5 Flash with structured outputs

## Installation

```bash
pip install -r input_parser/requirements.txt
```

## Usage

```python
from input_parser.parser import parse_user_input

result = parse_user_input("Swap sucrose for trehalose in HeLa cell freezing on ice to improve viability by 20%")
print(result.model_dump_json(indent=2))
```

## Schema Fields

- `original_input`: Full user text
- `domain`: Scientific field (e.g., Cell Biology, Chemistry)
- `subject`: Core subject (e.g., HeLa cells, C57BL/6 mice)
- `intervention`: Specific treatment or action
- `outcome_metric`: Measurable outcome with threshold
- `is_novelty_search`: Whether checking if experiment exists
- `control_condition`: Baseline comparison
- `target_quantity`: Concentration or amount
- `environmental_constraints`: Lab conditions (e.g., ice bath)
- `clarifying_questions`: Questions for missing information

## Requirements

- Python 3.10+
- google-genai
- pydantic
- GOOGLE_API_KEY environment variable
