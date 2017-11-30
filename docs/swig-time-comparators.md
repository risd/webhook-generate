There are a series of time comparators in swig that are maintained in the [risd/webhook-generate](https://github.com/risd/webhook-generate).

```swig
{% set yesterday = '2017-11-28T00:00:00' %}
{% set yesterdayAfternoon = '2017-11-28T12:00:00' %}
{% set today = '2017-11-29T00:00:00' %}
{% set todayEvening = '2017-11-29T20:00:00' %}
{% set tomorrow = '2017-11-30T00:00:00' %}

{{ 'build time'|debug }}
{{ build.time|debug }}

{{ 'build is today'|debug }}
{{ build.isToday(today)|debug }}

{{ 'build is not yesterday'|debug }}
{{ (!build.isToday(tomorrow))|debug }}

{{ 'today is today'|debug }}
{{ today|isSameDay(today)|debug }}
{{ build.isToday(today)|debug }}

{{ 'today is before tomorrow'|debug }}
{{ yesterday|isBeforeDay(today)|debug }}

{{ 'tomorrow is after today'|debug }}
{{ tomorrow|isAfterDay(today)|debug }}

{{ 'build is before today evening'|debug }}
{{ build.time|isBefore(todayEvening)|debug }}
{{ build.isBefore(todayEvening)|debug }}

{{ 'build is between yesterday & tomorrow'|debug }}
{{ build.time|isBetweenDay(yesterday, tomorrow)|debug }}

{{ 'build is between yesterday & tomorrow'|debug }}
{{ build.time|isBetween(yesterdayAfternoon, todayEvening)|debug }}

{{ 'build is between yesterday & tomorrow'|debug }}
{{ build.time|isBetweenDay(yesterdayAfternoon, todayEvening)|debug }}

```