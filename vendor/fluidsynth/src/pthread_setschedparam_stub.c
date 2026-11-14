#include <pthread.h>
int pthread_setschedparam(pthread_t thread, int policy, const struct sched_param *param) {
  (void)thread; (void)policy; (void)param;
  return 0;
}
