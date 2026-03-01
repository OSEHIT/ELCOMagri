"""
convert_data.py — SAA PRA (Productions Animales) XLSX → JSON
"""
import pandas as pd
import json
import re
import os

XLSX_PATH = "SAA_2010-2024_définitives_donnees_departementales.xlsx"
OUTPUT_DIR = "data"
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "saa_pra.json")

YEARS = list(range(2010, 2025))

CATEGORY_GROUPS = {
    "Bovins": list(range(1, 20)),
    "Porcins": list(range(20, 24)),
    "Caprins": list(range(24, 27)),
    "Ovins": list(range(27, 30)),
}


def clean_label(raw: str) -> tuple[str, str]:
    """Extract code and clean name from labels like '077 - Seine-et-Marne'."""
    match = re.match(r"^(\d{2,3}[A-B]?)\s*-\s*(.+)$", raw.strip())
    if match:
        return match.group(1), match.group(2).strip()
    return "", raw.strip()


def normalize_dep_code(code: str) -> str:
    """Normalize department code to match GeoJSON: '077' -> '77', '001' -> '01', '02A' -> '2A'."""
    code = code.strip()
    if code.endswith(("A", "B")):
        # 02A -> 2A
        return code.lstrip("0") or code
    if code.isdigit():
        return code.lstrip("0").zfill(2)
    return code


def assign_group(code_cat: int) -> str:
    """Map category code to animal group."""
    for group, codes in CATEGORY_GROUPS.items():
        if code_cat in codes:
            return group
    return "Autre"


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print("Loading PRA sheet...")
    df = pd.read_excel(XLSX_PATH, sheet_name="PRA", header=5)

    # Drop rows where department is missing (totals, empty rows)
    df = df.dropna(subset=["LIB_DEP"])

    # Filter out aggregate rows (France entière, etc.)
    df = df[df["LIB_DEP"].str.contains(r"^\d{2,3}", regex=True)]

    # Exclude aggregate/total categories (03,06,09,11,15,18,19,23,26,29)
    AGGREGATE_CODES = {3, 6, 9, 11, 15, 18, 19, 23, 26, 29}
    df = df[~df["LIB_SAA"].str.match(r"^(" + "|".join(f"{c:02d}" for c in AGGREGATE_CODES) + r")\s")]

    records = []

    for _, row in df.iterrows():
        code_reg, nom_reg = clean_label(str(row["LIB_REG2"]))
        code_dep, nom_dep = clean_label(str(row["LIB_DEP"]))
        code_cat_str, nom_cat = clean_label(str(row["LIB_SAA"]))

        try:
            code_cat = int(code_cat_str)
        except ValueError:
            continue

        groupe = assign_group(code_cat)

        for year in YEARS:
            prod_col = f"PROD_{year}"
            nb_col = f"NBTETE_{year}"
            poids_col = f"POIDS_MOY_{year}"

            prod = row.get(prod_col)
            nb_tetes = row.get(nb_col)
            poids_moy = row.get(poids_col)

            # Skip if no production data
            if pd.isna(prod) and pd.isna(nb_tetes):
                continue

            records.append({
                "code_dep": normalize_dep_code(code_dep),
                "departement": nom_dep,
                "code_reg": code_reg,
                "region": nom_reg,
                "code_cat": code_cat,
                "categorie": nom_cat,
                "groupe": groupe,
                "annee": year,
                "production": round(float(prod), 1) if pd.notna(prod) else None,
                "nb_tetes": int(nb_tetes) if pd.notna(nb_tetes) else None,
                "poids_moyen": round(float(poids_moy), 2) if pd.notna(poids_moy) else None,
            })

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False)

    size_mb = os.path.getsize(OUTPUT_FILE) / (1024 * 1024)
    print(f"Done: {len(records)} records -> {OUTPUT_FILE} ({size_mb:.2f} MB)")

    # Quick stats
    deps = set(r["code_dep"] for r in records)
    cats = set(r["code_cat"] for r in records)
    groupes = set(r["groupe"] for r in records)
    print(f"Departments: {len(deps)}, Categories: {len(cats)}, Groups: {groupes}")


if __name__ == "__main__":
    main()
