"""
Parse sampleProgram.numbers into program_data.json
"""
import json
import re
from numbers_parser import Document

DAYS = {'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'}


def row_values(row):
    return [str(cell.value).strip() if cell.value is not None else '' for cell in row]


def has_pct(s):
    return '%' in str(s)


def parse_sheet(sheet):
    table = sheet.tables[0]
    rows = [row_values(row) for row in table.iter_rows()]

    days = []
    current_day = None
    current_exercise = None
    awaiting_weights = False

    for vals in rows:
        # Skip rows with nothing at all
        if not any(v for v in vals):
            continue

        v0 = vals[0]

        # ── DAY HEADER (always takes priority) ──────────────────────────────
        if v0 in DAYS:
            awaiting_weights = False
            if current_exercise and current_day:
                current_day['exercises'].append(current_exercise)
                current_exercise = None
            if current_day:
                days.append(current_day)

            date_str = ''
            if vals[1]:
                date_str = vals[1].split(' ')[0]

            current_day = {'day': v0, 'date': date_str, 'exercises': []}
            continue

        if not current_day:
            continue

        # ── AWAITING WEIGHTS (row right after a scheme row) ─────────────────
        if awaiting_weights:
            if current_exercise and current_exercise.get('blocks'):
                current_exercise['blocks'][-1]['weight_vals'] = list(vals)
            awaiting_weights = False
            continue

        # ── NEW MAIN LIFT (name contains 'max' AND other cols have %) ───────
        if 'max' in v0.lower() and any(has_pct(v) for v in vals[1:] if v):
            if current_exercise:
                current_day['exercises'].append(current_exercise)

            current_exercise = {
                'type': 'main',
                'name': v0,
                'blocks': [{'scheme_vals': list(vals), 'weight_vals': []}]
            }
            awaiting_weights = True
            continue

        # ── CONTINUATION SCHEME (% in col 0, or col 0 empty with % elsewhere)
        if current_exercise and current_exercise['type'] == 'main':
            if has_pct(v0) or (not v0 and any(has_pct(v) for v in vals[1:] if v)):
                current_exercise['blocks'].append({
                    'scheme_vals': list(vals),
                    'weight_vals': []
                })
                awaiting_weights = True
                continue

        # ── END CURRENT MAIN LIFT if one was open ───────────────────────────
        if current_exercise:
            current_day['exercises'].append(current_exercise)
            current_exercise = None

        # ── RECOVERY / NOTE (nothing in cols 1+) ────────────────────────────
        if not any(v for v in vals[1:] if v):
            if v0:
                current_day['exercises'].append({'type': 'note', 'text': v0})
            continue

        # ── ACCESSORY (has text in col 1) ────────────────────────────────────
        if v0 and vals[1]:
            current_day['exercises'].append({
                'type': 'accessory',
                'name': v0,
                'prescription': [v for v in vals[1:] if v]
            })
            continue

        # Fallback
        if v0:
            current_day['exercises'].append({'type': 'note', 'text': v0})

    # Flush tail
    if current_exercise and current_day:
        current_day['exercises'].append(current_exercise)
    if current_day:
        days.append(current_day)

    return days


def main():
    doc = Document('sampleProgram.numbers')
    weeks = []

    for sheet in doc.sheets:
        name = sheet.name.strip().lower()
        if not name.startswith('week'):
            continue

        # Extract week number
        m = re.search(r'\d+', name)
        if not m:
            continue
        week_num = int(m.group())

        days = parse_sheet(sheet)
        weeks.append({'week': week_num, 'days': days})

    weeks.sort(key=lambda w: w['week'])

    # Grab program title from sheet 0 (week 1), row 0
    first_table = doc.sheets[0].tables[0]
    title = ''
    for row in first_table.iter_rows():
        v = str(row[0].value).strip() if row[0].value else ''
        if v:
            title = v
            break

    data = {'title': title, 'weeks': weeks}

    with open('program_data.json', 'w') as f:
        json.dump(data, f, indent=2)

    print(f"Done. {len(weeks)} weeks written to program_data.json")


if __name__ == '__main__':
    main()
