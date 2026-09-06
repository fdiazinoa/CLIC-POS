"""Offline proposed projection checks, requires jsonschema==4.25.1."""
import copy
import json
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker
root = Path(__file__).parent
schema = json.loads((root / 'originals.schema.json').read_text())
bundle = json.loads((root / 'fixtures.json').read_text())
Draft202012Validator.check_schema(schema)
def validator(name):
    return Draft202012Validator({**schema, '$ref': '#/$defs/' + name}, format_checker=FormatChecker())
count = 0
for f in bundle['fixtures']:
    for t in f['transactions'] + f['closedReferences']:
        validator('Refund' if t['documentType'] == 'REFUND' else 'Transaction').validate(t)
        count += 1
    for m in f['cashMovements']:
        validator('CashMovement').validate(m)
        count += 1
    for c in f['collections']:
        validator('BookingAdvance' if 'bookingActivityId' in c else 'Collection').validate(c)
        count += 1
validator('ZReport').validate(bundle['zReportShapeExample'])
for name in schema['$defs']:
    assert not validator(name).is_valid({}), name
bad = copy.deepcopy(bundle['fixtures'][0]['transactions'][0])
del bad['items'][0]['cartId']
assert not validator('Transaction').is_valid(bad)
bad = copy.deepcopy(bundle['fixtures'][1]['collections'][0])
del bad['receivedAmountBase']
assert not validator('Collection').is_valid(bad)
bad = copy.deepcopy(bundle['zReportShapeExample'])
del bad['cashExpected']
assert not validator('ZReport').is_valid(bad)
print(f'PASS: {count + 1} original projections; empty originals and 3 missing-operational-field negatives rejected. No coverage/closure authorization implied.')
