/* global module, require, __dirname */
module.exports = function config(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        require.resolve('@rn-agent-observer/rn-instrumentation/babel-plugin'),
        { projectRoot: __dirname },
      ],
    ],
  };
};
