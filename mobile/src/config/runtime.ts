import Constants, { ExecutionEnvironment } from 'expo-constants';

export const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export const isDevBuild =
  Constants.executionEnvironment === ExecutionEnvironment.Bare;

export const isStandalone =
  Constants.executionEnvironment === ExecutionEnvironment.Standalone;
