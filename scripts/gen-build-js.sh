#!/bin/sh
echo export const BUILD_VERSION = \"${EXPOSR_BUILD_VERSION}\"\;
echo export const BUILD_GIT_BRANCH = \"${EXPOSR_BUILD_GIT_BRANCH}\"\;
echo export const BUILD_GIT_COMMIT = \"${EXPOSR_BUILD_GIT_COMMIT}\"\;
echo export const BUILD_DATE = \"${EXPOSR_BUILD_DATE}\"\;
echo export const BUILD_USER = \"${EXPOSR_BUILD_USER}\"\;
echo export const BUILD_MACHINE = \"${EXPOSR_BUILD_MACHINE}\"\;