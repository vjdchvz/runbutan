// Android: AsyncStorage's database is capped at 6 MB for the WHOLE app by default. RUNbutan keeps every
// run's route in it (~100 KB for a half-hour run), so around 60 runs the cap is hit and saving a run
// (or importing a Strava history) starts failing with "database or disk is full". 200 MB is plenty.
const { withGradleProperties } = require('expo/config-plugins');

module.exports = (config) =>
  withGradleProperties(config, (c) => {
    c.modResults = c.modResults.filter((i) => !(i.type === 'property' && i.key === 'AsyncStorage_db_size_in_MB'));
    c.modResults.push({ type: 'property', key: 'AsyncStorage_db_size_in_MB', value: '200' });
    return c;
  });
