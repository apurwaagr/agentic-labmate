import os
from google import genai
from schemas import ParsedHypothesis
from prompt import SYSTEM_PROMPT

def parse_user_input(user_text: str) -> ParsedHypothesis:
    """
    Takes a messy, natural-language scientific question and extracts it
    into a structured ParsedHypothesis object using Gemini.
    """
    # Initialize the Gemini client.
    # Note: It expects the GOOGLE_API_KEY environment variable to be set.
    client = genai.Client(api_key="AIzaSyBie3XpmREs1Tc2F2YsVbqtORQ7_QU_B3o")

    # Call the Gemini API using structured outputs to ensure the output
    # matches our Pydantic schema perfectly.
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=f"{SYSTEM_PROMPT}\n\nUser Input: {user_text}",
        config={
            "response_mime_type": "application/json",
            "response_json_schema": ParsedHypothesis.model_json_schema(),
        },
    )

    # Return the extracted data as the Pydantic object
    return ParsedHypothesis.model_validate_json(response.text)

if __name__ == "__main__":
    # Test execution
    sample_text = "I'm curious about running an experiment to measure reaction yield when treating 5 moles of benzene with nitric acid in an ice bath. We usually just use sulfuric acid at room temp."
    
    print("User Text:", sample_text)
    print("-" * 50)
    print("Parsing with Gemini (this may take a few seconds)...\n")
    
    try:
        parsed_result = parse_user_input(sample_text)
        print("Successfully Parsed Result (JSON representation):")
        print(parsed_result.model_dump_json(indent=2))
    except Exception as e:
        print(f"An error occurred: {e}")
