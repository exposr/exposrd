registry?=exposr
node_image?=16.13.0-alpine3.14
platforms?=linux/amd64,linux/arm64,linux/arm/v7

project:=exposr-server
version:=$(shell git describe --tags --always --dirty 2> /dev/null || git rev-parse --short HEAD)
package_name=$(project)-$(version).tgz

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

ifneq (, $(publish))
push_flag=--push
endif
image.buildx:
	docker buildx create --name exposr-server-builder --driver docker-container || true
	docker buildx build \
		--builder exposr-server-builder \
		--platform $(platforms) \
		$(push_flag) \
		--build-arg NODE_IMAGE=$(node_image) \
		--build-arg PACKAGE_NAME=$(package_name) \
		-t $(registry)/$(project):$(version) .
	docker buildx rm exposr-server-builder

image.buildx.latest:
	docker buildx imagetools create --tag $(registry)/$(project):latest $(registry)/$(project):$(version)

image.buildx.unstable:
	docker buildx imagetools create --tag $(registry)/$(project):unstable $(registry)/$(project):$(version)

.PHONY: release release.publish builder.build image.build image.buildx image.buildx.latest image.buildx.unstable
