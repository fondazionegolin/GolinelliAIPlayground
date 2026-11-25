"""Admin stress-test runner: a separate process (compose service `loadtest`) that drives virtual students
through nginx exactly like browsers do, watches containers/DB while they run and streams everything live
to the admin page «Stress test». Running it outside the API keeps the measurement honest: the load
generator never competes with the event loop it is measuring."""
