# Mawareeth V2.0

Upgraded [Old Mawareeth website](http://v1.mawareeth.com) to [V2](https://www.mawareeth.com/en/) 

## About

This is an online calculation tool for inheritance distribution as per the Islamic rules amongst family members (heirs).
We used Django as a backend web development framework and bootstrap for frontend.

## Features

Mawareeth V2.0 now support:
- Distribution among close kin relatives (Father, Mother, Spouse, Daughters and Sons)
- Excess and shortage distribution of shares.
- User registration 
- Saving calculations to and retrieving from database 
- Multilanguage support (English and Arabic)

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

Please make sure to update tests as appropriate.

### Running the tests

The tests need PostgreSQL. For a quick local run, keep the test database between runs and skip the exhaustive engine sweeps:

```bash
uv run python manage.py test --keepdb --parallel auto --exclude-tag slow
```

Run the full suite, as CI does, before opening a pull request:

```bash
uv run python manage.py test --keepdb --parallel auto
```

Tests that run the engine many times derive from `TransactionTestCase`, not `TestCase`. Inside `TestCase`'s per-test transaction each engine run is a savepoint, and once a transaction holds more than 64 subtransactions PostgreSQL slows every query sharply.

## License

Mawareeth 2.0 is licensed under the GNU Affero General Public License v3.0 [AGPL-3.0](https://choosealicense.com/licenses/agpl-3.0/).

Permissions of this strongest copyleft license are conditioned on making available complete source code of licensed works and modifications, which include larger works using a licensed work, under the same license. Copyright and license notices must be preserved. Contributors provide an express grant of patent rights. When a modified version is used to provide a service over a network, the complete source code of the modified version must be made available.
