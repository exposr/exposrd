registry?=

project:=exposr-server
version:=$(shell git describe --tags --dirty 2> /dev/null || git rev-parse --short HEAD)
git_is_master:=$(shell bash -c '[[ $$(git rev-list origin/master..HEAD) == "" ]] && echo yes')

all:

image.build:
	docker build -t $(project):$(version) .
	docker tag $(project):$(version) $(project):latest

image.push: image.build
	docker tag $(project):$(version) $(registry)/$(project):$(version)
	docker push $(registry)/$(project):$(version)

image.push.latest: image.push
	docker tag $(project):$(version) $(registry)/$(project):latest
	docker push $(registry)/$(project):latest

.PHONY: image.build image.push image.push.latest
