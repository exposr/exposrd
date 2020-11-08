repository?=

project:=untitled-tunnel-project
version:=$(shell git describe --tags --dirty 2> /dev/null || git rev-parse --short HEAD)
git_is_master:=$(shell bash -c '[[ $$(git rev-list origin/master..HEAD) == "" ]] && echo yes')

all:

image-build:
	docker build -t $(project):$(version) .
	docker tag $(project):$(version) $(project):latest

image-push:
	docker tag $(project):$(version) $(repository)$(project):$(version)
	docker push $(repository)$(project):$(version)
ifeq ($(git_is_master), yes)
	docker tag $(project):$(version) $(repository)$(project):latest
	docker push $(repository)$(project):latest
endif
