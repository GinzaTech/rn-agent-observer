/* global module, require, __dirname */
module.exports = function config(api) {
  const environment = api.env();
  const enableObserverInstrumentation =
    environment === 'development' || environment === 'test';
  return {
    presets: ['babel-preset-expo'],
    plugins: enableObserverInstrumentation
      ? [
          [
            require.resolve('@rn-agent-observer/rn-instrumentation/babel-plugin'),
            { projectRoot: __dirname },
          ],
        ]
      : [],
  };
};
