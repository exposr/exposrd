registry?=exposr
node_image?=16.13.0-alpine3.14
package_name=exposr-server-$(version).tgz

project:=exposr-server
version:=$(shell git describe --tags --always --dirty 2> /dev/null || git rev-parse --short HEAD)

all: package.build.container image.build

define docker.run
	docker run --rm -i \
		-u $(shell id -u):$(shell id -g) \
		-v ${PWD}:/workdir \
		$(project)-builder \
		$1 $2 $3 $4 $5 $6 $7 $8 $9
endef

# Wraps any call and runs inside builder container
%.container: builder.build
	$(call docker.run, "make $(subst .container,,$@)")

release:
	yarn run release --skip.changelog

release.publish:
	git push --follow-tags origin

package.build:
	yarn pack --no-default-rc --production --frozen-lockfile --filename $(package_name)

# Builder image
builder.build:
	docker build --build-arg NODE_IMAGE=$(node_image) -t $(project)-builder --target builder .

# Docker package
image.build:
	docker build \
		--build-arg NODE_IMAGE=$(node_image) \
		--build-arg PACKAGE_NAME=$(package_name) \
		--pull -t $(project):$(version) .

image.publish: image.build
	docker tag $(project):$(version) $(registry)/$(project):$(version)
	docker push $(registry)/$(project):$(version)

image.publish.latest: image.publish
	docker tag $(project):$(version) $(registry)/$(project):latest
	docker push $(registry)/$(project):latest

image.publish.unstable: image.publish
	docker tag $(project):$(version) $(registry)/$(project):unstable
	docker push $(registry)/$(project):unstable

.PHONY: release release.publish builder.build image.build image.publish image.publish.latest image.publish.unstable
