"""Generates structured Markdown reports from JSON data."""

import os
from datetime import datetime
from typing import Any

class MarkdownGenerator:
    """Formats B2B JSON data into a clean, readable executive report."""

    def __init__(self, output_dir: str = "outputs") -> None:
        self.output_dir = output_dir
        os.makedirs(self.output_dir, exist_ok=True)

    def generate(self, data: dict[str, Any]) -> str:
        """Creates a Battlecard markdown file."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"battlecard_report_{timestamp}.md"
        filepath = os.path.join(self.output_dir, filename)

        with open(filepath, 'w', encoding='utf-8') as f:
            # Header-ul Raportului
            f.write("# 🏢 B2B Competitive Intelligence Battlecard\n\n")
            f.write(f"**Generated on:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"**Total words analyzed:** {data['metadata']['word_count']}\n\n")
            f.write("---\n\n")

            # Iteram prin fiecare segment analizat
            for chunk in data['chunks']:
                # Daca summary este gol (eroare), trecem peste
                summary = chunk.get('summary')
                if not summary:
                    continue

                f.write(f"## ⏱️ Video Segment {chunk['index'] + 1}\n\n")
                
                # 1. New Features (Lista)
                f.write("### 🚀 New Features Announced\n")
                features = summary.get('new_features', [])
                if isinstance(features, list) and len(features) > 0:
                    for feat in features:
                        f.write(f"- {feat}\n")
                else:
                    f.write("- *None specified in this segment*\n")
                
                # 2. Pricing Changes
                f.write("\n### 💰 Pricing & Packaging Updates\n")
                f.write(f"> {summary.get('pricing_changes', 'None specified')}\n")
                
                # 3. Marketing Message
                f.write("\n### 📣 Core Marketing Message\n")
                f.write(f"{summary.get('marketing_message', 'None specified')}\n")
                
                # 4. Objections & Risks
                f.write("\n### ⚠️ Potential Risks / Weaknesses\n")
                f.write(f"{summary.get('objections_or_risks', 'None specified')}\n")
                
                f.write("\n---\n\n")

        return filepath